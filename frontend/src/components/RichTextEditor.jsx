import React, { useState, useEffect } from "react";
import { CKEditor } from "@ckeditor/ckeditor5-react";
import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
import ApiService from "../services/api";
import "./RichTextEditor.css"; 

const RichTextEditor = ({
  value = "",
  onChange = () => {},
  placeholder = "Start typing your document...",
}) => {
  const [editorData, setEditorData] = useState("");

  useEffect(() => {
    const loadContent = async () => {
      if (value && typeof value === 'string' && value.toLowerCase().endsWith('.docx')) {
        try {
          const htmlContent = await ApiService.convertDocxToHtml(value);
          setEditorData(htmlContent);
        } catch (error) {
          console.error("RichTextEditor: Error converting DOCX to HTML:", error);
          setEditorData(`<p style="color: red;">Error loading document: ${error.message}</p>`);
        }
      } else {
        setEditorData(value || "");
      }
    };
    loadContent();
  }, [value]);

  return (
    <div className="document-editor-container">
      <CKEditor
        editor={ClassicEditor}
        data={editorData}
        onReady={(editor) => {
          const editableElement = editor.ui.view.editable.element;
          if (editableElement && editableElement.ownerDocument && editableElement.ownerDocument.defaultView) {
            const iframe = editableElement.ownerDocument.defaultView.frameElement;
            if (iframe && iframe.sandbox) {
              iframe.sandbox.add('allow-scripts');
            }
          }
        }}
        onChange={(event, editor) => {
          const data = editor.getData();
          onChange(data);
        }}
        config={{
          placeholder: placeholder,
        }}
      />
    </div>
  );
};

export default RichTextEditor;