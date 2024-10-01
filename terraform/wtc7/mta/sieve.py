from email.message import EmailMessage
from email.utils import getaddresses, parseaddr


def sieve(msg: EmailMessage) -> bool:
    m_from = parseaddr(msg.get("from", ""))
    m_to = parseaddr(msg.get("to", ""))
    m_cc = getaddresses((msg.get("cc", ""),))
    return True
