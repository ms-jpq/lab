#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('logger')
require('optparse')
require('resolv')
require('socket')

Thread.tap { _1.abort_on_exception = true }

pp Process.pid

Logger.new($stderr)

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

def bind_sockets(listen:)
  proto = Abbrev.abbrev(%i[udp tcp])
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
end

def run_udp(sock:)
  sock => Socket
  sock.accept => [Socket => conn, Addrinfo]
  len = conn.read(2).unpack1('n')
  req = conn.read(len)
  Ractor.yield(req.freeze)
  rsp = Ractor.receive
  conn.write(rsp)
ensure
  conn&.close
end

def run_tcp(sock:)
  sock => Socket
  sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
  ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
  Ractor.yield(req.freeze)
  rsp = Ractor.receive
  sock.send(rsp, 0, ai)
end

def ractors(sockets:)
  sockets => Array
  sockets.map do |socket|
    Ractor.new(socket) do |sock|
      sock => Socket
      opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)
      case opt.int
      when Socket::SOCK_STREAM
        loop { run_udp(sock:) }
      when Socket::SOCK_DGRAM
        loop { run_tcp(sock:) }
      end
    end
  end
end

def srv_fail(query:)
  Resolv::DNS::Message
    .new(query&.id || 0)
    .tap do
      _1.qr = 1
      _1.opcode = query&.opcode || Resolv::DNS::OpCode::Query
      _1.aa = 1
      _1.rd = 0
      _1.ra = 0
      _1.rcode = Resolv::DNS::RCode::ServFail
    end
end

def resolve(dns:, query:)
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
end

def query(dns:, msg:)
  query = Resolv::DNS::Message.decode(msg)
  resolve(dns:, query:)
rescue StandardError => e
  logger.error(e)
  srv_fail(query:)
end

def main
  parse_args => { listen:, upstream: }
  sockets = bind_sockets(listen:)
  tx = ractors(sockets:)
  Resolv::DNS.open do |dns|
    loop do
      Ractor.select(*tx) => [Ractor => ractor, String => msg]
      rsp = query(dns:, msg:).encode
      ractor.send(rsp)
    end
  end
end

main
