# frozen_string_literal: true

module DNS
  def srv(sock:)
    sock => Socket
    root = Fiber.current
    opt = sock.getsockopt(Socket::SOL_SOCKET, Socket::SO_TYPE)

    Fiber.new do
      case opt.int
      in Socket::SOCK_STREAM
        loop do
          sock.accept => [Socket => conn, Addrinfo]
          len = conn.read(2).unpack1('n')
          req = conn.read(len)
          rsp = root.transfer(req)
          conn.write(rsp)
        ensure
          conn&.close
        end
      in Socket::SOCK_DGRAM
        loop do
          sock.recvfrom(Resolv::DNS::UDPSize) => [
            String => req,
            Addrinfo => addr
          ]
          ai = Socket.sockaddr_in(addr.ip_port, addr.ip_address)
          rsp = root.transfer(req)
          sock.send(rsp, 0, ai)
        end
      end
    end
  end

  def srv_fail(query: nil)
    query => Resolv::DNS::Message | nil
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
      .encode
  end

  def query(dns:, msg:)
    msg => String
    Resolv::DNS::Message.decode(msg) => Resolv::DNS::Message => query
    rsp = Resolv::DNS::Message.new(query.id)
    query.each_question do |name, typeclass|
      name => Resolv::DNS::Name
      dns
        .getresources(name, typeclass)
        .each { rsp.add_answer(name, _1.ttl, _1) }
    end
    rsp.encode
  rescue StandardError => e
    Logger.new($stderr).error(e)
    srv_fail(query:)
  end
end
