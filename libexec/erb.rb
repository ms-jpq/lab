#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

%w[
  English
  base64
  bigdecimal
  cgi
  date
  digest
  erb
  etc
  fcntl
  fiber
  fileutils
  io/console
  ipaddr
  json
  logger
  net/http
  open3
  openssl
  optparse
  ostruct
  pathname
  pp
  securerandom
  set
  shellwords
  socket
  stringio
  syslog
  tempfile
  thread
  time
  tsort
  uri
  yaml
].each { require(_1) }

src, dst = ARGV.map { Pathname(_1) }
json = JSON.parse($stdin.read)

Dir.chdir(src.parent)

xform = -> { _1.tr(".", "_").to_sym }

parse = ->(data) do
  case data
  in **h
    h.to_h { [xform[_1], parse[_2]] }.then { Data.define(*_1.keys).new(**_1) }
  in [*a]
    a.map(&parse)
  else
    data
  end
end

data = parse[json]
rendered = ERB.new(path.read).result_with_hash(data)
dst.write(rendered)
dst.chmod(src.stat.mode)
