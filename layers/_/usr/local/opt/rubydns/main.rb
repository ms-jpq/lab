#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('logger')
require('optparse')
require('resolv')
require('socket')

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
  listen => Array
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

def run_udp(logger:, sock:)
  sock => Socket
  sock.accept => [Socket => conn, Addrinfo]
  len = conn.read(2).unpack1('n')
  req = conn.read(len)
  Ractor.yield(req.freeze)
  rsp = Ractor.receive
  conn.write(rsp)
rescue IOError => e
  logger.error(e)
ensure
  conn&.close
end

def run_tcp(logger:, sock:)
  sock => Socket
  sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
  ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
  Ractor.yield(req.freeze)
  rsp = Ractor.receive
  sock.send(rsp, 0, ai)
rescue IOError => e
  logger.error(e)
end

def ractors(sockets:)
  sockets => Array
  sockets.map do |socket|
    Ractor.new(socket) do |sock|
      sock => Socket
      logger = Logger.new($stderr)
      opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)
      case opt.int
      in Socket::SOCK_STREAM
        loop { run_udp(logger:, sock:) }
      in Socket::SOCK_DGRAM
        loop { run_tcp(logger:, sock:) }
      end
    end
  end
end

def srv_fail(query:)
  Resolv::DNS::Message
    .new(query&.id.to_i)
    .tap do
      _1.qr = 1
      _1.aa = 1
      _1.opcode = query&.opcode || Resolv::DNS::OpCode::Query
      _1.rcode = Resolv::DNS::RCode::ServFail
    end
end

def resolve(dns:, query:)
  dns => Resolv::DNS
  rsp = Resolv::DNS::Message.new(query.id)
  Enumerator
    .new do |y|
      query.each_question do |name, typeclass|
        name => Resolv::DNS::Name
        dns.getresources(name, typeclass).each { y << [name, _1] }
      end
    end
    .each { rsp.add_answer(_1, _2.ttl, _2) }
  rsp
end

def query(dns:, msg:)
  query = Resolv::DNS::Message.decode(msg)
  resolve(dns:, query:)
rescue StandardError => e
  logger.error(e)
  srv_fail(query:)
end

def serve(tx:)
  tx => Array
  Resolv::DNS.open do |dns|
    loop do
      Ractor.select(*tx) => [Ractor => ractor, String => msg]
      rsp = query(dns:, msg:).encode
    ensure
      ractor.send(rsp)
    end
  end
end

def main
  Thread.tap { _1.abort_on_exception = true }

  parse_args => { listen:, upstream: }
  sockets = bind_sockets(listen:)
  tx = ractors(sockets:)
  serve(tx:)
end

main
