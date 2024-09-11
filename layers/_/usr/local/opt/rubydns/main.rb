#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('logger')
require('optparse')
require('resolv')
require('socket')

pp Process.pid

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

ractors =
  sockets.map do |socket|
    Ractor.new(socket) do |sock|
      sock => Socket
      opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)

      case opt.int
      when Socket::SOCK_STREAM
        loop do
          sock.accept => [Socket => conn, Addrinfo]
          len = conn.read(2).unpack1('n')
          req = conn.read(len)
          Ractor.yield(req.freeze)
          rsp = Ractor.receive
          conn.write(rsp)
        ensure
          conn&.close
        end
      when Socket::SOCK_DGRAM
        loop do
          sock.recvfrom(Resolv::DNS::UDPSize) => [
            String => req,
            Addrinfo => addr
          ]
          ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
          Ractor.yield(req.freeze)
          rsp = Ractor.receive
          sock.send(rsp, 0, ai)
        end
      end
    end
  end

Resolv::DNS.open do |dns|
  loop do
    Ractor.select(*ractors) => [Ractor => ractor, String => msg]
    reply =
      begin
        Resolv::DNS::Message.decode(msg) => query

        Resolv::DNS::Message
          .new(query.id)
          .tap do |rsp|
            query.each_question do |name, typeclass|
              name => Resolv::DNS::Name
              dns
                .getresources(name, typeclass)
                .each { rsp.add_answer(name, _1.ttl, _1) }
            end
          end
      rescue StandardError => e
        Logger.new($stderr).error(e)
        Resolv::DNS::Message
          .new(query&.id || 0)
          .tap do
            _1.qr = 1
            _1.opcode = query&.opcode || 0
            _1.aa = 1
            _1.rd = 0
            _1.ra = 0
            _1.rcode = Resolv::DNS::RCode::ServFail
          end
      end
    ractor.send(reply.encode)
  end
end
