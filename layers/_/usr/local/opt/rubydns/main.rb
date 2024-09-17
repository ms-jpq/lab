#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('ipaddr')
require('logger')
require('optparse')
require('pathname')
require('resolv')
require('socket')

AI =
  Data.define(:proto, :ip, :port) do
    def addr = Addrinfo.public_send(proto, ip, port).freeze

    def bind
      loop do
        return(
          addr.bind.tap do
            _1.listen(Socket::SOMAXCONN) if _1.local_address.socktype == Socket::SOCK_STREAM
          end
        )
      rescue Errno::EADDRNOTAVAIL
        sleep(1)
      end
    end

    def conn = addr.connect

    def self.parse(addr:)
      addr => String
      addr.reverse.split(':', 2).map(&:reverse) => [p, ip]
      port = Integer(p)
      %i[tcp udp].map { AI.new(proto: _1, ip:, port:) }
    end
  end

def parse_args
  options, =
    {}.then do |into|
      parsed =
        OptionParser
        .new do
          _1.on('--listen LISTEN', Array)
          _1.on('--upstream UPSTREAM', Array)
          _1.on('--pid PIDFILE', String)
        end
          .parse(ARGV, into:)
      [into, parsed]
    end

  options
end

def recv_tcp(sock:, &blk)
  [sock, blk] => [Socket, Proc]
  sock.accept => [Socket => conn, Addrinfo]
  conn.read(2)&.unpack1('n') => Integer | nil => len
  return if len.nil?

  conn.read(len) => String => req
  blk.call(req&.freeze) => String => rsp
  [rsp.bytesize].pack('n') => String => len
  conn&.write(len)
  conn&.write(rsp)
ensure
  conn&.close
end

def recv_udp(sock:, &blk)
  [sock, blk] => [Socket, Proc]
  sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
  ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
  blk.call(req&.freeze) => String => rsp
  sock.send(rsp, 0, ai)
end

def do_recv(logger:, rx:, &blk)
  [logger, rx, blk] => [Logger, AI, Proc]
  sock = rx.bind
  loop do
    case sock.local_address.socktype
    in Socket::SOCK_STREAM
      recv_tcp(sock:, &blk)
    in Socket::SOCK_DGRAM
      recv_udp(sock:, &blk)
    end
  rescue IOError => e
    logger.error(e)
  end
end

def send_tcp(addr:, req:)
  [addr, req] => [AI, String]
  conn = addr.conn
  [req.bytesize].pack('n') => String => len
  conn.write(len)
  conn.write(req)
  conn.read(2)&.unpack1('n') => Integer | nil => len
  return '' if len.nil?

  conn.read(len) => String | nil => rsp
  rsp
ensure
  conn&.close
end

def send_udp(addr:, req:)
  [addr, req] => [AI, String]
  conn = addr.conn
  conn.write(req)
  conn.recvfrom(Resolv::DNS::UDPSize) => [String => rsp, Addrinfo]
  rsp
ensure
  conn&.close
end

def do_send(logger:, tx:, req:)
  [logger, tx, req] => [Logger, AI, String]
  case tx.proto
  in :tcp
    send_tcp(addr: tx, req:)
  in :udp
    send_udp(addr: tx, req:)
  end
rescue IOError => e
  logger.error(e)
end

def xform(logger:, msg:)
  [logger, msg] => [Logger, String]
  dns = Resolv::DNS::Message.decode(msg)
  home = Resolv::DNS::Name.create('home.arpa.')

  dns.answer.reject! do
    [_1, _2, _3] => [Resolv::DNS::Name, Integer, Resolv::DNS::Resource]
    next unless _1.subdomain_of?(home)

    !IPAddr.new(_3.address.to_s).private?
  end
  dns.encode
rescue Resolv::DNS::DecodeError => e
  logger.error(e)
  msg
end

def main
  Thread.tap { _1.abort_on_exception = true }
  logger = Logger.new($stderr)

  parse_args => { pid:, listen:, upstream: }
  Pathname(pid).write(Process.pid.to_s)

  recv = listen.flat_map { AI.parse(addr: _1) }
  snd = upstream.lazy.flat_map { AI.parse(addr: _1) }.group_by(&:proto)

  threads =
    recv.map do |rx|
      Thread.new do
        do_recv(logger:, rx:) do |req|
          tx = snd.fetch(rx.proto).sample
          do_send(logger:, tx:, req:) => String => msg
          xform(logger:, msg:) => String => rsp
          rsp
        end
      end
    end

  threads.each(&:join)
end

main
