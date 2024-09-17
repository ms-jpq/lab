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

AI = Data.define(:proto, :ip, :port) do
  def addr = Addrinfo.public_send(proto, ip, port).freeze

  def bind
    addr.bind.tap do
      _1.listen(Socket::SOMAXCONN) if _1.local_address.socktype == Socket::SOCK_STREAM
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

def new_logger = Logger.new($stderr)

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

def recv_tcp(logger:, sock:, &blk)
  [logger, sock] => [Logger, Socket]
  rsp = ''
  conn = self.then do
    sock.accept => [Socket => conn, Addrinfo]
    conn.read(2).unpack1('n') => Integer => len
    conn.read(len) => String => req
    conn
  ensure
    blk.call(req&.freeze) => String => rsp
  end
  [rsp.bytesize].pack('n') => String => len
  conn&.write(len)
  conn&.write(rsp)
rescue IOError => e
  logger.error(e)
ensure
  conn&.close
end

def recv_udp(logger:, sock:, &blk)
  [logger, sock] => [Logger, Socket]
  rsp = ''
  ai = self.then do
    sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
    Socket.sockaddr_in(addr.ip_port, addr.ip_address)
  ensure
    blk.call(req&.freeze) => String => rsp
  end
  sock.send(rsp, 0, ai)
rescue IOError => e
  logger.error(e)
end

def do_recv(addr:, &blk)
  addr => AI
  Fiber.new do
    logger = new_logger
    sock = addr.bind
    case sock.local_address.socktype
    in Socket::SOCK_STREAM
      loop { recv_tcp(logger:, sock:, &blk) }
    in Socket::SOCK_DGRAM
      loop { recv_udp(logger:, sock:, &blk) }
    end
  end
  .resume
end

def send_tcp(logger:, addr:, req:)
  [logger, addr, req] => [Logger, AI, String]
  tap do
    conn = addr.conn
    [req.bytesize].pack('n') => String => len
    conn.write(len)
    conn.write(req)
    conn.read(2).unpack1('n') => Integer => len
    conn.read(len) => String => rsp
  ensure
    Fiber.yield(rsp&.freeze)
    conn&.close
  end
rescue IOError => e
  logger.error(e)
end

def send_udp(logger:, addr:, req:)
  [logger, addr, req] => [Logger, AI, String]
  tap do
    sock = addr.conn
    sock.write(req)
    sock.recvfrom(Resolv::DNS::UDPSize) => [String => rsp, Addrinfo]
  ensure
    Fiber.yield(rsp&.freeze)
    sock&.close
  end
rescue IOError => e
  logger.error(e)
end

def do_send(addr:, req:)
  addr => AI
  Fiber.new do
    logger = new_logger
    case addr.proto
    in :tcp
      loop { send_tcp(logger:, addr:, req:) }
    in :udp
      loop { send_udp(logger:, addr:, req:) }
    end
  end
  .resume
end

def xform(logger:, msg:)
  [logger, msg] => [Logger, String]
  dns = Resolv::DNS::Message.decode(msg)
  home = Resolv::DNS::Name.create('home.arpa.')

  dns.answer.reject! do
    [_1, _2, _3] => [Resolv::DNS::Name, Integer, Resolv::DNS::Resource]
    unless _1.subdomain_of?(home) &&
           _3.instance_of?(Resolv::DNS::Resource::IN::AAAA)
      next
    end

    !IPAddr.new(_3.address.to_s).private?
  end
  dns.encode
rescue StandardError => e
  logger.error(e)
  msg
end

def main
  Thread.tap { _1.abort_on_exception = true }

  parse_args => { pid:, listen:, upstream: }
  Pathname(pid).write(Process.pid.to_s)

  recv = listen.flat_map { AI.parse(addr: _1) }
  snd = upstream.lazy.flat_map { AI.parse(addr: _1) }.group_by(&:proto)
  logger = new_logger
  recv.map do |addr|
    Thread.new do
      do_recv(addr:) do |req|
        addr = snd.fetch(addr.proto).sample
        do_send(addr:, req:) => String => msg
        xform(logger:, msg:) => String => rsp
        rsp
      end
    end
  end
  .each(&:join)
end

main
