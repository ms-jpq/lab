#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('abbrev')
require('etc')
require('io/wait')
require('ipaddr')
require('logger')
require('optparse')
require('pathname')
require('resolv')
require('socket')
require('timeout')

UDP_SIZE = Resolv::DNS::UDPSize * 32
HOME = Resolv::DNS::Name.create('home.arpa.')
TIMEOUT = 6

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

def set_timeout(sock:, timeout: TIMEOUT)
  sock => Socket

  packed = [timeout, 0].pack('l_2')
  [Socket::SO_RCVTIMEO, Socket::SO_SNDTIMEO].each do
    sock.setsockopt(Socket::SOL_SOCKET, _1, packed)
  end
end

def bind(rx:)
  rx => Addrinfo

  loop do
    sock = Socket.new(rx.pfamily, rx.socktype)

    case rx.socktype
    in Socket::SOCK_STREAM
      sock.setsockopt(Socket::SOL_SOCKET, Socket::SO_REUSEADDR, true)
      sock.bind(rx)
      sock.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, true)
      sock.listen(Socket::SOMAXCONN)
    in Socket::SOCK_DGRAM
      sock.bind(rx)
    end

    set_timeout(sock:)
    return sock
  rescue Errno::EADDRNOTAVAIL
    sock&.close
    sleep(1)
  end
end

def io_wait(read: nil, write: nil, timeout: TIMEOUT)
  unblocked =
    case [read, write]
    in [Socket, nil]
      read.wait_readable(timeout)
    in [nil, Socket]
      write.wait_writable(timeout)
    end

  raise(Timeout::Error) unless unblocked
end

def io_read(conn:, len:)
  [conn, len] => [Socket | nil, Integer | nil]
  return if conn.nil? || len.nil?

  acc = []
  size = 0
  while size < len
    io_wait(read: conn)
    conn.recvmsg(len - size) => String | nil => buf
    break if buf.nil? || buf.empty?

    size += buf.bytesize
    acc << buf
  end

  acc.join('').freeze
end

def io_write(conn:, buf:)
  [conn, buf] => [Socket | nil, String | nil]
  return if conn.nil? || buf.nil?

  size = 0
  while size < buf.bytesize
    io_wait(write: conn)
    conn.sendmsg(buf[size..]) => Integer => n
    size += n
  end
end

def recv_tcp(log:, sock:, &blk)
  [log, sock, blk] => [Logger, Socket, Proc]
  sock.accept => [Socket => conn, Addrinfo]

  Thread.new do
    io_read(conn:, len: 2)&.unpack1('n') => Integer | nil => len
    next if len.nil?

    io_read(conn:, len:) => String | nil => req
    blk.call(req&.freeze) => String => rsp
    [rsp.bytesize].pack('n') => String => len

    io_write(conn:, buf: len)
    io_write(conn:, buf: rsp)
  rescue Timeout::Error => e
    log.debug(e)
  rescue SystemCallError => e
    log.error(e)
  ensure
    conn&.close
  end
end

def recv_udp(log:, sock:, &blk)
  [log, sock, blk] => [Logger, Socket, Proc]
  io_wait(read: sock)
  sock.recvfrom(UDP_SIZE) => [String => req, Addrinfo => addr]

  Thread.new do
    ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
    blk.call(req&.freeze) => String => rsp
    io_wait(write: sock)
    sock.send(rsp, 0, ai)
  rescue Timeout::Error => e
    log.debug(e)
  rescue SystemCallError => e
    log.error(e)
  end
end

def do_recv(log:, rx:, &blk)
  [log, rx, blk] => [Logger, Addrinfo, Proc]
  sock = bind(rx:)

  loop do
    case sock.local_address.socktype
    in Socket::SOCK_STREAM
      recv_tcp(log:, sock:, &blk)
    in Socket::SOCK_DGRAM
      recv_udp(log:, sock:, &blk)
    end
  rescue Timeout::Error => e
    log.debug(e)
  rescue IOError, Errno::ECONNREFUSED => e
    log.error(e)
  end
end

def send_tcp(tx:, req:)
  [tx, req] => [Addrinfo, String]
  [req.bytesize].pack('n') => String => len
  conn = tx.connect

  set_timeout(sock: conn)
  io_write(conn:, buf: len)
  io_write(conn:, buf: req)
  io_read(conn:, len: 2)&.unpack1('n') => Integer | nil => len
  return if len.nil?

  io_read(conn:, len:) => String | nil => rsp
  rsp
ensure
  conn&.close
end

def send_udp(tx:, req:)
  [tx, req] => [Addrinfo, String]
  conn = tx.connect

  set_timeout(sock: conn)
  io_write(conn:, buf: req)
  io_wait(read: conn)
  conn.recvfrom(UDP_SIZE) => [String => rsp, Addrinfo]
  rsp
ensure
  conn&.close
end

def do_send(log:, tx:, req:)
  [log, tx, req] => [Logger, Addrinfo, String]

  case tx.socktype
  in Socket::SOCK_STREAM
    send_tcp(tx:, req:)
  in Socket::SOCK_DGRAM
    send_udp(tx:, req:)
  end
end

def failed(log:, req:)
  log => Logger
  case req
  in '' | nil
    ''
  else
    dns = Resolv::DNS::Message.decode(req)
    rsp = Resolv::DNS::Message.new(dns.id)
    rsp.qr = 1
    rsp.opcode = dns.opcode
    rsp.rcode = Resolv::DNS::RCode::ServFail
    dns.question.each { rsp.add_question(_1, _2) }
    rsp.encode
  end
rescue Resolv::DNS::DecodeError
  ''
end

def xform(log:, msg:)
  [log, msg] => [Logger, String]
  dns = Resolv::DNS::Message.decode(msg)

  dns.answer.reject! do |name, ttl, resource|
    [name, ttl, resource] => [Resolv::DNS::Name, Integer, Resolv::DNS::Resource]
    next unless name.subdomain_of?(HOME) && resource.respond_to?(:address)

    !IPAddr.new(resource.address.to_s).private?
  end
  dns.encode => String => rsp
  rsp
rescue Resolv::DNS::DecodeError => e
  log.error(e)
  msg
end

def main
  Thread.tap { _1.abort_on_exception = true }
  log = Logger.new($stderr, level: Logger::WARN)

  parse_args => { listen:, upstream: }

  listen.flat_map(&method(:parse_addrs)) => Array => recv
  upstream.lazy.flat_map(&method(:parse_addrs)).group_by(&:socktype) => Hash => snd

  threads =
    recv.map do |rx|
      Thread.new do
        rx => Addrinfo
        do_recv(log:, rx:) do |req|
          req => String | nil
          next failed(log:, req:) if req.nil?

          snd.fetch(rx.socktype).sample => Addrinfo => tx
          do_send(log:, tx:, req:) => String | nil => msg
          next failed(log:, req:) if msg.nil?

          xform(log:, msg:) => String => rsp
          rsp
        end
      end
    end

  threads.each(&:join)
end

main
