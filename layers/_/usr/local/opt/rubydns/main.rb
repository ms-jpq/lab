#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('English')
require('abbrev')
require('etc')
require('logger')
require('optparse')
require('resolv')
require('socket')

require_relative('dns')

Thread.tap { _1.abort_on_exception = true }

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

proto = Abbrev.abbrev(%i[udp tcp])
options => { listen:, upstream: }

sockets =
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

sockets
  .map do |sock|
    Thread.new do
      extend(DNS)
      fib = srv(sock:)
      Resolv::DNS.open do |dns|
        rsp = ''
        loop do
          msg = fib.transfer(rsp)
          rsp = query(dns:, msg:)
        end
      end
    end
  end
  .each(&:join)
