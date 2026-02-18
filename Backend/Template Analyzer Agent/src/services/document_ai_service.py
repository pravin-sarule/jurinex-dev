import os
import json
import base64
import asyncio
import io
import datetime
from pypdf import PdfReader, PdfWriter
from google.cloud import documentai
from google.cloud import storage
from google.oauth2 import service_account
from ..config import settings

class DocumentAIService:
    def __init__(self):
        # Decode the service account key
        try:
            key_json = json.loads(base64.b64decode(settings.GCS_KEY_BASE64).decode('utf-8'))
            self.credentials = service_account.Credentials.from_service_account_info(key_json)
        except Exception as e:
            print(f"Error initializing GCS Credentials: {e}")
            self.credentials = None
        
        self.project_id = settings.GCLOUD_PROJECT_ID
        self.location = settings.DOCUMENT_AI_LOCATION
        self.processor_id = settings.DOCUMENT_AI_PROCESSOR_ID
        
        if self.credentials:
            self.client = documentai.DocumentProcessorServiceClient(credentials=self.credentials)
            self.storage_client = storage.Client(credentials=self.credentials, project=self.project_id)
        else:
            self.client = None
            self.storage_client = None

    async def parallel_process_pdf(self, file_content: bytes):
        """
        Splits PDF into chunks and processes them in parallel using online method.
        This bypasses the 15-page limit and is faster than batch processing.
        """
        try:
            reader = PdfReader(io.BytesIO(file_content))
            total_pages = len(reader.pages)
            print(f"DEBUG: Parallel processing started for {total_pages} pages.")
            
            chunk_size = 15 # Document AI Online processing limit
            chunks = []
            
            for i in range(0, total_pages, chunk_size):
                writer = PdfWriter()
                for j in range(i, min(i + chunk_size, total_pages)):
                    writer.add_page(reader.pages[j])
                
                chunk_io = io.BytesIO()
                writer.write(chunk_io)
                chunks.append(chunk_io.getvalue())

            print(f"DEBUG: Split PDF into {len(chunks)} chunks. Starting parallel AI requests...")
            
            # Process all chunks in parallel
            tasks = [self.process_online(chunk) for chunk in chunks]
            results = await asyncio.gather(*tasks)
            
            print(f"DEBUG: All {len(chunks)} AI chunks completed. Merging results...")
            return "\n".join(results)
        except Exception as e:
            print(f"DEBUG: Parallel processing failed: {e}")
            raise e

    async def batch_process_pdf(self, file_content: bytes, file_name: str):
        """
        Batch process a PDF using Google Cloud Document AI.
        """
        if not self.client or not self.storage_client:
            raise Exception("Document AI Service not properly initialized. Check GCS_KEY_BASE64.")

        # 1. Upload to Input Bucket
        print(f"DEBUG: Uploading {file_name} to input bucket {settings.GCS_INPUT_BUCKET_NAME}...")
        input_bucket = self.storage_client.bucket(settings.GCS_INPUT_BUCKET_NAME)
        blob = input_bucket.blob(file_name)
        blob.upload_from_string(file_content, content_type='application/pdf')
        print(f"DEBUG: Upload complete. GCS Path: gs://{settings.GCS_INPUT_BUCKET_NAME}/{file_name}")
        
        gcs_input_uri = f"gs://{settings.GCS_INPUT_BUCKET_NAME}/{file_name}"
        gcs_output_uri = f"gs://{settings.GCS_OUTPUT_BUCKET_NAME}/"

        # 2. Configure Batch Request
        gcs_documents = documentai.GcsDocuments(
            documents=[{"gcs_uri": gcs_input_uri, "mime_type": "application/pdf"}]
        )
        input_config = documentai.BatchDocumentsInputConfig(gcs_documents=gcs_documents)
        
        # Output config
        output_config = documentai.DocumentOutputConfig(
            gcs_output_config={"gcs_uri": gcs_output_uri}
        )
        
        name = self.client.processor_path(self.project_id, self.location, self.processor_id)
        
        request = documentai.BatchProcessRequest(
            name=name,
            input_documents=input_config,
            document_output_config=output_config,
        )
        
        # 3. Trigger Batch Process
        print(f"DEBUG: Triggering batch_process_documents...")
        loop = asyncio.get_event_loop()
        operation = await loop.run_in_executor(None, lambda: self.client.batch_process_documents(request=request))
        
        print(f"DEBUG: Operation started: {operation.operation.name}. Waiting for results...")
        await loop.run_in_executor(None, lambda: operation.result(timeout=600))
        
        # 4. Read results from Output Bucket
        print(f"DEBUG: Batch process complete. Reading results from {settings.GCS_OUTPUT_BUCKET_NAME}...")
        output_bucket = self.storage_client.bucket(settings.GCS_OUTPUT_BUCKET_NAME)
        
        operation_id = operation.operation.name.split('/')[-1]
        prefix = f"{operation_id}/"
        
        blobs = output_bucket.list_blobs(prefix=prefix)
        
        full_text = ""
        blob_list = list(blobs)
        print(f"DEBUG: Found {len(blob_list)} result blobs.")
        for blob in sorted(blob_list, key=lambda x: x.name):
            if blob.name.endswith(".json"):
                print(f"DEBUG: Downloading {blob.name}...")
                json_content = blob.download_as_string()
                document = documentai.Document.from_json(json_content, ignore_unknown_fields=True)
                full_text += document.text
                
        return full_text

    async def process_online(self, file_content: bytes):
        """
        Processes a single chunk synchronously.
        """
        if not self.client:
            raise Exception("Document AI Service not properly initialized.")

        name = self.client.processor_path(self.project_id, self.location, self.processor_id)
        raw_document = documentai.RawDocument(content=file_content, mime_type="application/pdf")
        request = documentai.ProcessRequest(name=name, raw_document=raw_document)
        
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: self.client.process_document(request=request))
        
        return result.document.text

    async def upload_to_gcs(self, file_content: bytes, file_name: str, content_type: str) -> str:
        """
        Uploads a file to the configured image bucket and returns the GS URI.
        """
        if not self.storage_client:
            print("ERROR: Storage client not initialized.")
            return None

        target_bucket_name = settings.GCS_IMAGE_BUCKET_NAME
        print(f"DEBUG: Uploading {file_name} to bucket {target_bucket_name}...")
        
        try:
            # Run blocking upload in executor
            loop = asyncio.get_event_loop()
            
            def _upload():
                bucket = self.storage_client.bucket(target_bucket_name)
                blob = bucket.blob(file_name)
                blob.upload_from_string(file_content, content_type=content_type)
                return f"gs://{target_bucket_name}/{file_name}"

            gs_uri = await loop.run_in_executor(None, _upload)
            print(f"DEBUG: Upload successful: {gs_uri}")
            return gs_uri
        except Exception as e:
            print(f"ERROR uploading to GCS: {e}")
            return None

    def generate_signed_url(self, gs_uri: str, expiration_mins: int = 60) -> str:
        """
        Generates a signed URL for a GS URI.
        """
        if not gs_uri or not gs_uri.startswith("gs://"):
            return gs_uri
            
        try:
            # Parse gs://bucket/blob_name
            parts = gs_uri[5:].split("/", 1)
            if len(parts) != 2:
                return gs_uri
                
            bucket_name, blob_name = parts
            bucket = self.storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            
            return blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=expiration_mins),
                method="GET"
            )
        except Exception as e:
            print(f"Error generating signed URL for {gs_uri}: {e}")
            return gs_uri
