#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('logger')
require('optparse')
require('resolv')
require('socket')

require_relative('dns')
puts(Process.pid)

Thread.tap { _1.abort_on_exception = true }

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

proto = Abbrev.abbrev(%i[udp tcp])
options => { listen:, upstream: }

sockets =
  listen
  .lazy
  .map do
    _1.split(':', 2) => [p, addr]
    [proto.fetch(p), addr]
  end
  .flat_map do
    case _1
    in [:udp, addr]
      Socket.udp_server_sockets(addr)
    in [:tcp, addr]
      Socket.tcp_server_sockets(addr)
    end
  end
  .to_a

tx =
  sockets.map do |sock|
    sock => Socket
    opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)

    Fiber.new do
      case opt.int
      in Socket::SOCK_STREAM
        loop do
          sock.accept => [Socket => conn, Addrinfo]
          len = conn.read(2).unpack1('n')
          req = conn.read(len)
          rsp = Fiber.yield(req)
          conn.write(rsp)
        ensure
          conn&.close
        end
      in Socket::SOCK_DGRAM
        loop do
          sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
          ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
          rsp = Fiber.yield(req)
          sock.send(rsp, 0, ai)
        end
      end
    end
  end

Resolv::DNS.open do |dns|
  loop do
    case Ractor.select(*tx, move: true)
    in [_, nil]
      break
    in [Ractor, Socket => conn]
      begin
        query(dns:, msg:)
        conn.write(query)
      rescue IOError => e
        Logger.error(e)
      ensure
        conn.close
      end
    in [Ractor, [Socket => sock, String => ai, String => msg]]
      query = query(dns:, msg:)
      begin
        sock.send(query, 0, ai)
      rescue IOError => e
        Logger.error(e)
      end
    end
  end
end
