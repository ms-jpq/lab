from email.message import EmailMessage
from email.utils import getaddresses, parseaddr
from logging import getLogger


def sieve(msg: EmailMessage) -> bool:
    m_name, m_from = parseaddr(msg.get("from", ""))
    _, m_to = parseaddr(msg.get("to", ""))
    m_cnames, m_cc = zip(*getaddresses([msg.get("cc", "")]))
    getLogger().debug(f"from: {m_from}, to: {m_to}, cc: {m_cc}")
    return True
