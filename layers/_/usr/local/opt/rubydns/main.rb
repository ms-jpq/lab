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

def bind_sockets(listen:)
  listen => Array
  listen
    .lazy
    .flat_map do
      _1.split(':', 2) => [ip, port]
      addr = Addrinfo.new(ip, port)
      case _1
      in [:udp, addr]
        Socket.udp_server_sockets(addr)
      in [:tcp, addr]
        Socket.tcp_server_sockets(addr)
      end
    end
    .to_a
end

def fwd_tcp(logger:, addr:)
  [logger, addr] => [Logger, Addrinfo]
  addr.connect do |sock|
    loop do
      Ractor.receive => String => req
      sock.write([req.bytesize].pack('n'))
      sock.write(req)
      sock.read(2).unpack1('n') => Integer => len
      sock.read(len) => String => rsp
      Ractor.yield(rsp.freeze)
    end
  end
rescue IOError => e
  logger.error(e)
end

def fwd_udp(logger:, addr:)
  [logger, addr] => [Logger, Addrinfo]
  addr.connect do |sock|
    Ractor.receive => String => req
    sock.write(req)
    sock.read(Resolv::DNS::UDPSize) => String => rsp
    Ractor.yield(rsp.freeze)
  end
rescue IOError => e
  logger.error(e)
end

def recv_tcp(logger:, sock:)
  sock => Socket
  sock.accept => [Socket => conn, Addrinfo]
  len = conn.read(2).unpack1('n')
  req = conn.read(len)
  Ractor.yield(req.freeze)
  rsp = Ractor.receive
  len = [rsp.bytesize].pack('n')
  conn.write(len)
  conn.write(rsp)
rescue IOError => e
  logger.error(e)
ensure
  conn&.close
end

def recv_udp(logger:, sock:)
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
      case sock.local_address.socktype
      in Socket::SOCK_STREAM
        fwd_tcp(address:)
        loop { recv_tcp(logger:, sock:) }
      in Socket::SOCK_DGRAM
        fwd_udp(address:)
        loop { recv_udp(logger:, sock:) }
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

def resolve(dns:, query:, &reject)
  dns => Resolv::DNS
  query.qr = 1
  query.ra = 1
  Enumerator
    .new do |y|
      query.each_question do |name, typeclass|
        name => Resolv::DNS::Name
        dns.getresources(name, typeclass).each { y << [name, _1] }
      end
    end
    .lazy
    .reject(&reject)
    .each { query.add_answer(_1, _2.ttl, _2) }
  query
end

def query(dns:, msg:)
  query = Resolv::DNS::Message.decode(msg)
  resolve(dns:, query:) do
    _1 => Resolv::DNS::Name
    home = Resolv::DNS::Name.create('home.arpa.')
    unless _1.subdomain_of?(home) &&
           _2.instance_of?(Resolv::DNS::Resource::IN::AAAA)
      next
    end

    !IPAddr.new(_2.address.to_s).private?
  end
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

  parse_args => { pid:, listen:, upstream: }
  Pathname(pid).write(Process.pid.to_s)

  sockets = bind_sockets(listen:)
  tx = ractors(sockets:)
  serve(tx:)
end

main
