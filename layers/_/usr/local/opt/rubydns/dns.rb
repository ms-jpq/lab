# frozen_string_literal: true

require('logger')
require('resolv')
require('socket')

Request =
  Data.define(:msg, :src) do
    def read
      case src
      in Socket
        src.read
      else
        msg
      end
    end

    def write(rsp)
      rsp => String
      case src
      in Socket::UDPSource
        src.reply(rsp)
      in Socket
        src.write(rsp)
      end
    end
  end

module DNS
  def parse(req)
    req => Request
    req.read => String => msg
    req.write(msg)
  end
end
