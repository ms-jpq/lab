# frozen_string_literal: true

module DNS
  def parse(msg:)
    msg => String
    decoded = Resolv::DNS::Message.decode(msg)
    p decoded
    msg
  end
end
