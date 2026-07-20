from integrations.indian_kanoon.client import IndianKanoonClient


def fetch_document(client: IndianKanoonClient, candidate):
    return client.fetch_full_document(candidate)
