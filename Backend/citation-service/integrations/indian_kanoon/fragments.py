from integrations.indian_kanoon.client import IndianKanoonClient


def fetch_fragment(client: IndianKanoonClient, candidate):
    return client.fetch_fragment(candidate)
