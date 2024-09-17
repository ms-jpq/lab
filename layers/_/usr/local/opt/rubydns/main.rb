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

def recv_tcp(logger:, sock:)
  [logger, sock] => [Logger, Socket]
  sock.accept => [Socket => conn, Addrinfo]
  rsp = ''
  tap do
    conn.read(2).unpack1('n') => Integer => len
    conn.read(len) => String => req
  ensure
    Ractor.yield(req&.freeze)
    Ractor.receive => String => rsp
  end
  [rsp.bytesize].pack('n') => String => len
  conn.write(len)
  conn.write(rsp)
rescue IOError => e
  logger.error(e)
ensure
  conn&.close
end

def recv_udp(logger:, sock:)
  [logger, sock] => [Logger, Socket]
  rsp = ''
  ai = self.then do
    sock.recvfrom(Resolv::DNS::UDPSize) => [String => req, Addrinfo => addr]
    Socket.sockaddr_in(addr.ip_port, addr.ip_address)
  ensure
    Ractor.yield(req&.freeze)
    Ractor.receive => String => rsp
  end
  sock.send(rsp, 0, ai)
rescue IOError => e
  logger.error(e)
end

def do_recv(addr:)
  addr => AI
  Ractor.new(addr) do |a|
    logger = Logger.new($stderr)
    sock = a.bind
    case sock.local_address.socktype
    in Socket::SOCK_STREAM
      loop { recv_tcp(logger:, sock:) }
    in Socket::SOCK_DGRAM
      loop { recv_udp(logger:, sock:) }
    end
  end
end

def send_tcp(logger:, addr:)
  [logger, addr] => [Logger, AI]
  Ractor.receive => String => req
  tap do
    sock = addr.conn
    sock.write([req.bytesize].pack('n'))
    sock.write(req)
    sock.read(2).unpack1('n') => Integer => len
    sock.read(len) => String => rsp
  ensure
    Ractor.yield(rsp&.freeze)
  end
rescue IOError => e
  logger.error(e)
end

def send_udp(logger:, addr:)
  [logger, addr] => [Logger, AI]
  Ractor.receive => String => req
  tap do
    sock = addr.conn
    sock.write(req)
    sock.read(Resolv::DNS::UDPSize) => String => rsp
  ensure
    Ractor.yield(rsp&.freeze)
  end
rescue IOError => e
  logger.error(e)
end

def do_send(addr:)
  addr => AI
  Ractor.new(addr) do |addr|
    logger = Logger.new($stderr)
    case addr.proto
    in :tcp
      loop { send_tcp(logger:, addr:) }
    in :udp
      loop { send_udp(logger:, addr:) }
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

# def query(dns:, msg:)
#   query = Resolv::DNS::Message.decode(msg)
#   resolve(dns:, query:) do
#     _1 => Resolv::DNS::Name
#     home = Resolv::DNS::Name.create('home.arpa.')
#     unless _1.subdomain_of?(home) &&
#            _2.instance_of?(Resolv::DNS::Resource::IN::AAAA)
#       next
#     end
#
#     !IPAddr.new(_2.address.to_s).private?
#   end
# rescue StandardError => e
#   logger.error(e)
#   srv_fail(query:)
# end

def main
  Thread.tap { _1.abort_on_exception = true }

  parse_args => { pid:, listen:, upstream: }
  Pathname(pid).write(Process.pid.to_s)

  recv = listen.flat_map { AI.parse(addr: _1) }
  snd = upstream.flat_map { AI.parse(addr: _1) }
  rx = recv.map { [_1.proto, do_recv(addr: _1)] }.group_by(&:first)
  tx = snd.map { [_1.proto, do_send(addr: _1)] }.group_by(&:first)

  %i[tcp udp].flat_map do |proto|
    rs = rx.fetch(proto, []).map(&:last)
    tx.fetch(proto, []).lazy.map(&:last).map do |ch|
      Ractor.new(rs, ch) do |rs, ch|
        Ractor.select(*rs) => [Ractor => r, String => req]
        ch.send(req)
        ch.take => String => rsp
        r.send(rsp)
      end
    end
    .to_a
  end
  .each(&:take)
end

main
