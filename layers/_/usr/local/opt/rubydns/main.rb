#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('optparse')

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

recv =
  sockets.map do |socket|
    Ractor.new(socket) do |sock|
      sock => Socket
      close_incoming
      opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)
      case opt.int
      in Socket::SOCK_STREAM
        loop do
          sock.accept => [Socket => conn, Addrinfo]
          Ractor.yield(conn, move: true)
        end
      in Socket::SOCK_DGRAM
        loop do
          sock.recvfrom(Resolv::DNS::UDPSize) => [String => msg, Addrinfo => addr]
          ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
          Ractor.yield([sock.dup, ai, msg])
        end
      end
    end
  end

Etc.nprocessors => Integer => nprocs
nprocs
  .times
  .map do
    Ractor.new(recv) do |ractors|
      extend(DNS)
      ractors => Array

      loop do
        case Ractor.select(*ractors, move: true)
        in [_, nil]
          break
        in [Ractor, Socket => conn]
          begin
          ensure
            conn.close
          end
        in [Ractor, [Socket => sock, String => ai, String => msg]]
          sock.send(msg, 0, ai)
        end
      end
    end
  end
  .each(&:take)
