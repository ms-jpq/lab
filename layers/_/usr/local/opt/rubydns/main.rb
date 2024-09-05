#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('etc')
require('optparse')

require_relative('dns')

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
        _1.on('--upstream UPSTREAM', String)
      end
        .parse(ARGV, into:)
    [into, parsed]
  end

options => { verbose:, upstream: }

recv = [
  Ractor
    .new do
      Ractor.receive => Array => socks
      next if socks.empty?

      Socket.udp_server_loop_on(socks) do |msg, src|
        [msg, src] => [String, Socket::UDPSource]
        addr = src.remote_address
        req = Request.new(msg:, addr:, src:)
        Ractor.yield(req, move: true)
      end
    end
    .tap { _1.send([], move: true) },
  Ractor
    .new do
      Ractor.receive => Array => socks
      next if socks.empty?

      Socket.accept_loop(socks) do |src, addr|
        [src, addr] => [Socket, Addrinfo]
        req = Request.new(msg: nil, addr:, src:)
        Ractor.yield(req, move: true)
      end
    end
    .tap { _1.send([], move: true) }
].each(&:close_incoming)

Etc
  .nprocessors
  .times
  .map do
    Ractor
      .new do
        Ractor.receive => Array => ractors
        loop do
          case Ractor.select(*ractors, move: true)
          in [_, nil]
            break
          in [Ractor, Request => req]
            DNS.parse(req)
          end
        end
      end
      .tap { _1.send(recv) }
  end
  .each(&:take)