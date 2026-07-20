from integrations.indian_kanoon.client import IndianKanoonClient


def fetch_metadata(client: IndianKanoonClient, candidate):
    return client.fetch_meta(candidate)
