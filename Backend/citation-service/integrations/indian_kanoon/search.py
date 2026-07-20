from integrations.indian_kanoon.client import IndianKanoonClient


def search(client: IndianKanoonClient, query: str, doctypes: str, issue_id: str):
    return client.search(query, doctypes, issue_id)
