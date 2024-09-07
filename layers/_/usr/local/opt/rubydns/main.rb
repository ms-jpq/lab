#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('etc')
require('optparse')

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

options => { listen:, upstream: }
sockets = listen.flat_map { Socket.tcp_server_sockets(_1) }

recv = [
  Ractor
    .new do
      Ractor.receive => Array => socks
      next if socks.empty?

      Socket.udp_server_loop_on(socks) do |msg, src|
        [msg, src] => [String, Socket::UDPSource]
        req = Request.new(msg:, src:)
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
        req = Request.new(msg: nil, src:)
        Ractor.yield(req, move: true)
      end
    end
    .tap { _1.send(sockets, move: true) }
].each(&:close_incoming)

Etc.nprocessors => Integer => nprocs
1
  .times
  .map do
    Ractor
      .new do
        extend(DNS)

        Ractor.receive => Array => ractors
        rs = ractors.length

        while rs.positive?
          case Ractor.select(*ractors, move: true)
          in [_, nil]
            rs -= 1
          in [Ractor, Request => req]
            parse(req)
          end
        end
      end
      .tap { _1.send(recv) }
  end
  .each(&:take)

pp(:EOF)
