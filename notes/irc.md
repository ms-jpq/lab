# IRC

## Join

```bash
/bouncer network create -name '<network>' -addr ircs://irc.libera.chat:6697 -nick '<nick>' -username '<name>' -realname '<name>'

/bouncer sasl set-plain -network '<network>' '<nick>' '<pass>'

/bouncer network update '<network>' -enabled false
/bouncer network update '<network>' -enabled true

/bouncer sasl status -network '<network>'
```

## Reset

```bash
/bouncer sasl reset -network '<network>'
```

```bash
/msg NickServ SENDPASS '<nick>'

/msg NickServ SETPASS '<nick>' '<one-time-key>' '<pass>'

/msg NickServ IDENTIFY '<nick>' '<pass>'
```

```bash
/msg NickServ REGISTER '<pass>' '<email>'
```
