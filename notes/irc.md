# IRC

```bash
/bouncer network create -name '<network>' -addr ircs://irc.libera.chat:6697 -nick '<name>' -username '<name>' -realname '<name>'

/bouncer sasl set-plain -network '<network>' '<name>' '<pass>'

/bouncer network update '<network>' -enabled false
/bouncer network update '<network>' -enabled true

/bouncer sasl status -network '<network>'
```

