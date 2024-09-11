# frozen_string_literal: true

module DNS
  def srv_fail(query: nil)
    Resolv::DNS::Message.new(query ? query.id : 0).tap do
      _1.qr = 1
      _1.opcode = query ? query.opcode : 0
      _1.aa = 1
      _1.rd = 0
      _1.ra = 0
      _1.rcode = Resolv::DNS::RCode::ServFail
    end
  end

  def parse(msg:)
    msg => String
    Resolv::DNS::Message.decode(msg)
  rescue StandardError => e
    Logger.error(e)
    srv_fail(query:)
  end

  def query(dns:, msg:)
    parse(msg:) => Resolv::DNS::Message => query
    rsp = Resolv::DNS::Message.new(query.id)
    query.each_question do |name, typeclass|
      [name, typeclass] => [Resolv::DNS::Name, Resolv::DNS::Resource]
      dns.getresources(name, typeclass).each do
        rsp.add_answer(name, _1.ttl, _1)
      end
    end
    rsp.encode
  end
end
