# OpenSSL

```bash
# list alt names
openssl s_client -connect '<host>:<port>' </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
```
