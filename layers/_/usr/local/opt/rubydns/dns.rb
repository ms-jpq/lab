#!/usr/bin/env -S -- ruby
# frozen_string_literal: true

require('optparse')

Thread.tap do
  _1.abort_on_exception = true
  _1.report_on_exception = false
end


options, args =
  {}.then do |into|
    parsed =
      OptionParser
        .new do
          _1.on('--verbose VERBOSE', TrueClass)
          _1.on('--name [NAME]', String)
        end
        .parse(ARGV, into:)
    [into, parsed]
  end

options => { verbose:, name: }


