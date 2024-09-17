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

UDP_SIZE = Resolv::DNS::UDPSize * 8

def parse_args
  options, =
    {}.then do |into|
      parsed =
        OptionParser
        .new do
          _1.on('--listen LISTEN', Array)
          _1.on('--upstream UPSTREAM', Array)
        end
          .parse(ARGV, into:)
      [into, parsed]
    end

  options
end

def parse_addrs(addr)
  addr => String
  addr.reverse.split(':', 2).map(&:reverse) => [p, ip]
  port = Integer(p)
  [Addrinfo.tcp(ip, port), Addrinfo.udp(ip, port)]
end

def bind(rx:)
  rx => Addrinfo
  loop do
    return(
      rx.bind.tap do
        _1.listen(Socket::SOMAXCONN) if _1.local_address.socktype == Socket::SOCK_STREAM
      end
    )
  rescue Errno::EADDRNOTAVAIL
    sleep(1)
  end
end

def recv_tcp(sock:, &blk)
  [sock, blk] => [Socket, Proc]
  sock.accept => [Socket => conn, Addrinfo]
  Thread.new do
    conn.read(2)&.unpack1('n') => Integer | nil => len
    return if len.nil?

    conn.read(len) => String => req
    blk.call(req&.freeze) => String => rsp
    [rsp.bytesize].pack('n') => String => len
    conn&.write(len)
    conn&.write(rsp)
  rescue IOError => e
    logger.error(e)
  ensure
    conn&.close
  end
end

def recv_udp(sock:, &blk)
  [sock, blk] => [Socket, Proc]
  sock.recvfrom(UDP_SIZE) => [String => req, Addrinfo => addr]
  Thread.new do
    ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
    blk.call(req&.freeze) => String => rsp
    sock.send(rsp, 0, ai)
  rescue IOError => e
    logger.error(e)
  end
end

def do_recv(logger:, rx:, &blk)
  [logger, rx, blk] => [Logger, Addrinfo, Proc]
  sock = bind(rx:)
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

def send_tcp(tx:, req:)
  [tx, req] => [Addrinfo, String]
  conn = tx.connect
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

def send_udp(tx:, req:)
  [tx, req] => [Addrinfo, String]
  conn = tx.connect
  conn.write(req)
  conn.recvfrom(UDP_SIZE) => [String => rsp, Addrinfo]
  rsp
ensure
  conn&.close
end

def do_send(logger:, tx:, req:)
  [logger, tx, req] => [Logger, Addrinfo, String]
  case tx.socktype
  in Socket::SOCK_STREAM
    send_tcp(tx:, req:)
  in Socket::SOCK_DGRAM
    send_udp(tx:, req:)
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
    next unless _1.subdomain_of?(home) && _3.respond_to?(:address)

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

  parse_args => { listen:, upstream: }

  recv = listen.flat_map(&method(:parse_addrs))
  snd = upstream.lazy.flat_map(&method(:parse_addrs)).group_by(&:socktype)

  threads =
    recv.map do |rx|
      Thread.new do
        do_recv(logger:, rx:) do |req|
          tx = snd.fetch(rx.socktype).sample
          do_send(logger:, tx:, req:) => String => msg
          xform(logger:, msg:) => String => rsp
          rsp
        end
      end
    end

  threads.each(&:join)
end

main
