#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('optparse')

require_relative('dns')
pp(Process.pid)

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

recv =
  sockets.map do |socket|
    Ractor
      .new do
        Ractor.receive => Socket => sock
        opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)
        case opt.int
        when Socket::SOCK_STREAM
          Socket.accept_loop([sock]) do |soc, addr|
            [soc, addr] => [Socket, Addrinfo]
            Ractor.yield(soc, move: true)
          end
        when Socket::SOCK_DGRAM
          Socket.accept_loop([sock]) do |soc, addr|
            [soc, addr] => [Socket, Addrinfo]
            Ractor.yield(soc, move: true)
          end
        end
      end
      .tap do
        _1.send(socket, move: true)
        _1.close_incoming
      end
  end

Etc.nprocessors => Integer => nprocs
nprocs
  .times
  .map do
    Ractor
      .new do
        extend(DNS)

        Ractor.receive => Array => ractors
        rs = ractors.length

        while rs.positive?
          case Ractor.select(*ractors, move: true)
          in [_, nil]
            rs -= 1
          in [Ractor, Socket => socket]
            p socket
          end
        end
      end
      .tap { _1.send(recv) }
  end
  .each(&:take)

pp(:EOF)
