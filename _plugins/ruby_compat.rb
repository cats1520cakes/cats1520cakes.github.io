# Local development compatibility shim for Ruby >= 3.2.
#
# Liquid 4.0.3 (pinned by the github-pages gem) still calls Object#tainted?,
# which was removed in Ruby 3.2. Jekyll loads files in _plugins/ only in
# non-safe mode, so GitHub Pages (safe mode) ignores this file entirely.
unless Object.method_defined?(:tainted?)
  class Object
    def tainted?
      false
    end

    def taint
      self
    end

    def untaint
      self
    end
  end
end
