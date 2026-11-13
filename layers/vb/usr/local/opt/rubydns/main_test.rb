# frozen_string_literal: true

require('minitest/autorun')
require('stringio')
require_relative 'main'

class RubyDNSTest < Minitest::Test
  parallelize_me!

  def setup
    @log = Logger.new(StringIO.new)
  end

  def test_parse_args
    original = ARGV.dup
    ARGV.replace(['--listen', '127.0.0.1:3535,::1:3535', '--upstream', '127.0.0.1:53'])
    assert_equal({ listen: ['127.0.0.1:3535', '::1:3535'], upstream: ['127.0.0.1:53'] }, parse_args)
  ensure
    ARGV.replace(original)
  end

  def test_addresses_preserve_ipv4_and_ipv6
    ['127.0.0.1', '::1', 'fd24:d84c:c786:4::1'].each do |ip|
      tcp, udp = parse_addrs("#{ip}:3535")
      assert_equal([ip, 3535, Socket::SOCK_STREAM], [tcp.ip_address, tcp.ip_port, tcp.socktype])
      assert_equal([ip, 3535, Socket::SOCK_DGRAM], [udp.ip_address, udp.ip_port, udp.socktype])
    end
  end

  def test_invalid_address_contract
    assert_raises(NoMatchingPatternError) { parse_addrs(nil) }
    assert_raises(ArgumentError) { parse_addrs('127.0.0.1:invalid') }
  end

  def test_filter_only_removes_public_home_addresses
    dns = Resolv::DNS::Message.new(42)
    dns.qr = 1
    dns.add_question('dog.home.arpa', Resolv::DNS::Resource::IN::A)
    dns.add_answer('dog.home.arpa', 60, Resolv::DNS::Resource::IN::A.new('192.168.1.2'))
    dns.add_answer('dog.home.arpa', 60, Resolv::DNS::Resource::IN::A.new('8.8.8.8'))
    dns.add_answer('dog.home.arpa', 60, Resolv::DNS::Resource::IN::AAAA.new('fd00::2'))
    dns.add_answer('dog.home.arpa', 60, Resolv::DNS::Resource::IN::AAAA.new('2001:4860:4860::8888'))
    dns.add_answer('dog.example', 60, Resolv::DNS::Resource::IN::A.new('8.8.8.8'))
    dns.add_answer('alias.home.arpa', 60, Resolv::DNS::Resource::IN::CNAME.new(Resolv::DNS::Name.create('dog.home.arpa.')))
    dns = Resolv::DNS::Message.decode(dns.encode)
    result = Resolv::DNS::Message.decode(xform(log: @log, msg: dns.encode))
    assert_equal(42, result.id)
    assert_equal(dns.question, result.question)
    assert_equal(dns.answer.values_at(0, 2, 4, 5), result.answer)
  end

  def test_malformed_reply_is_preserved
    assert_equal('bad', xform(log: @log, msg: 'bad'))
  end

  def test_failure_preserves_query_identity
    query = Resolv::DNS::Message.new(123)
    query.add_question('dog.home.arpa', Resolv::DNS::Resource::IN::A)
    query = Resolv::DNS::Message.decode(query.encode)
    result = Resolv::DNS::Message.decode(failed(req: query.encode))
    assert_equal(123, result.id)
    assert_equal(query.question, result.question)
    assert_equal(1, result.qr)
    assert_equal(Resolv::DNS::RCode::ServFail, result.rcode)
  end

  def test_failure_with_no_decodable_query
    [nil, '', 'bad'].each do |req|
      assert_equal('', failed(req:))
    end
  end

  def test_read_boundary_and_type_contract
    reader, writer = Socket.pair(:UNIX, :STREAM, 0)
    assert_equal('', io_read(conn: reader, len: 0))
    assert_nil(io_read(conn: nil, len: 2))
    assert_nil(io_read(conn: reader, len: nil))
    assert_raises(NoMatchingPatternError) { io_read(conn: reader, len: '2') }
  ensure
    reader&.close
    writer&.close
  end

  def test_write_transmits_bytes
    reader, writer = Socket.pair(:UNIX, :STREAM, 0)
    io_write(conn: writer, buf: "dog\x00".b)
    assert_equal("dog\x00".b, reader.recv(4))
  ensure
    reader&.close
    writer&.close
  end

  def test_read_collects_fragmented_bytes
    reader, writer = Socket.pair(:UNIX, :STREAM, 0)
    reader.define_singleton_method(:recv) { |length| super([length, 1].min) }
    writer.send('dog', 0)
    assert_equal('dog', io_read(conn: reader, len: 3))
  ensure
    reader&.close
    writer&.close
  end

  def test_read_returns_short_data_at_eof
    reader, writer = Socket.pair(:UNIX, :STREAM, 0)
    writer.send('d', 0)
    writer.shutdown(Socket::SHUT_WR)
    assert_equal('d', io_read(conn: reader, len: 3))
  ensure
    reader&.close
    writer&.close
  end

  def test_wait_times_out
    reader, writer = Socket.pair(:UNIX, :STREAM, 0)
    assert_raises(Timeout::Error) { io_wait(read: reader, timeout: 0) }
  ensure
    reader&.close
    writer&.close
  end

  def test_udp_round_trip
    server = Socket.new(:INET, :DGRAM)
    server.bind(Addrinfo.udp('127.0.0.1', 0))
    worker = Thread.new do
      request, client = server.recvfrom(UDP_SIZE)
      server.send(request.reverse, 0, client.to_sockaddr)
    end
    assert_equal('god', do_send(tx: server.local_address, req: 'dog'))
    worker.value
  ensure
    worker&.kill&.join
    server&.close
  end

  def test_tcp_round_trip
    server = Socket.new(:INET, :STREAM)
    server.bind(Addrinfo.tcp('127.0.0.1', 0))
    server.listen(1)
    worker = Thread.new do
      conn, = server.accept
      length = conn.read(2).unpack1('n')
      request = conn.read(length)
      response = request.reverse
      conn.write([response.bytesize].pack('n') + response)
    ensure
      conn&.close
    end
    assert_equal('god', do_send(tx: server.local_address, req: 'dog'))
    worker.value
  ensure
    worker&.kill&.join
    server&.close
  end

  def test_tcp_listener_frames_response
    server = Socket.new(:INET, :STREAM)
    server.bind(Addrinfo.tcp('127.0.0.1', 0))
    server.listen(1)
    client = server.local_address.connect
    client.write([3].pack('n') + 'dog')
    worker = recv_tcp(log: @log, sock: server) { |request| request.reverse }
    assert_equal([3].pack('n') + 'god', Timeout.timeout(2) { client.read(5) })
    worker.value
  ensure
    worker&.kill&.join
    client&.close
    server&.close
  end

  def test_upstream_failure_propagates
    tx = Addrinfo.tcp('127.0.0.1', 53)
    tx.define_singleton_method(:connect) { raise Errno::ECONNREFUSED }
    assert_raises(Errno::ECONNREFUSED) { do_send(tx:, req: 'dog') }
  end

  def test_udp_listener_replies_to_sender
    server = Socket.new(:INET, :DGRAM)
    server.bind(Addrinfo.udp('127.0.0.1', 0))
    client = server.local_address.connect
    client.send('dog', 0)
    worker = recv_udp(log: @log, sock: server) { |request| request.reverse }
    assert_equal('god', Timeout.timeout(2) { client.recv(UDP_SIZE) })
    worker.value
  ensure
    worker&.kill&.join
    client&.close
    server&.close
  end
end
