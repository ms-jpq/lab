#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('optparse')
require('resolv')
require('socket')

Thread.tap do
  _1.abort_on_exception = true
  _1.report_on_exception = false
end

options, =
  {}.then do |into|
    parsed =
      OptionParser
      .new do
        _1.on('--verbose VERBOSE', TrueClass)
        _1.on('--upstream [NAME]', String)
      end
        .parse(ARGV, into:)
    [into, parsed]
  end

options => { verbose:, upstream: }

tcp_socks = ''
udp_socks = ''

Ractor.new do
  Socket.udp_server_loop_on(udp_socks) do |msg, msg_src|
    [msg, msg_src] => [String, Socket::UDPSource]
  end
end

Ractor.new do
  Socket.accept_loop(tcp_socks) do |sock, addr|
    [sock, addr] => [Socket, Addrinfo]
  end
end
