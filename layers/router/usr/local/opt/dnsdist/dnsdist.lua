setSecurityPollSuffix("")
newServer({address = "127.0.0.53"})
addDOHLocal("127.0.0.53:8053", nil, nil, "/dns", {reusePort = true})
