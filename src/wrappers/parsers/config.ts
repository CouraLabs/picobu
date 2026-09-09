export default {
  parsers: [
    {
      filetype: "python",
      wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
      queries: {
        highlights: ["https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm"],
      },
    },
    {
      filetype: "rust",
      wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm"],
      },
    },
    {
      filetype: "go",
      wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm"],
      },
    },
    {
      filetype: "cpp",
      wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm"],
      },
    },
    {
      filetype: "csharp",
      wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/highlights.scm"],
      },
    },
    {
      filetype: "bash",
      wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm"],
      },
    },
    {
      filetype: "c",
      wasm: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm"],
      },
    },
    {
      filetype: "java",
      wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm"],
      },
    },
    {
      filetype: "kotlin",
      wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"],
      },
    },
    {
      filetype: "ruby",
      wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm"],
      },
    },
    {
      filetype: "php",
      wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
      queries: {
        highlights: ["https://github.com/tree-sitter/tree-sitter-php/raw/refs/heads/master/queries/highlights.scm"],
      },
    },
    {
      filetype: "scala",
      wasm: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/scala/highlights.scm"],
      },
    },
    {
      filetype: "html",
      wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
      queries: {
        highlights: ["https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm"],
      },
    },
    {
      filetype: "vue",
      wasm: "https://github.com/anomalyco/tree-sitter-vue/releases/download/v0.1.2/tree-sitter-vue.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/html_tags/highlights.scm",
          "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/vue/highlights.scm",
        ],
      },
    },
    {
      filetype: "hcl",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-hcl/releases/download/v1.2.0/tree-sitter-hcl.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/hcl/highlights.scm"],
      },
    },
    {
      filetype: "json",
      wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm"],
      },
    },
    {
      filetype: "yaml",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/yaml/highlights.scm"],
      },
    },
    {
      filetype: "haskell",
      wasm: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.1/tree-sitter-haskell.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/haskell/highlights.scm"],
      },
    },
    {
      filetype: "css",
      wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm"],
      },
    },
    {
      filetype: "julia",
      wasm: "https://github.com/tree-sitter/tree-sitter-julia/releases/download/v0.23.1/tree-sitter-julia.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/julia/highlights.scm"],
      },
    },
    {
      filetype: "lua",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/highlights.scm"],
      },
    },
    {
      filetype: "ocaml",
      wasm: "https://github.com/tree-sitter/tree-sitter-ocaml/releases/download/v0.24.2/tree-sitter-ocaml.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ocaml/highlights.scm"],
      },
    },
    {
      filetype: "clojure",
      wasm: "https://github.com/anomalyco/tree-sitter-clojure/releases/download/v0.0.1/tree-sitter-clojure.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/clojure/highlights.scm"],
      },
    },
    {
      // Query pinned to the grammar repo commit that matches the 0.7.3 wasm
      // ("Baseline to nvim-treesitter highlights"); the nvim-master query
      // references nodes this grammar revision does not have.
      filetype: "swift",
      wasm: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.3/tree-sitter-swift.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/c79af47572af041d5df15e9d805cf575bb0265e0/queries/highlights.scm"],
      },
    },
    {
      filetype: "toml",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/toml/highlights.scm"],
      },
    },
    {
      filetype: "nix",

      wasm: "https://github.com/ast-grep/ast-grep.github.io/raw/40b84530640aa83a0d34a20a2b0623d7b8e5ea97/website/public/parsers/tree-sitter-nix.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/nix/highlights.scm"],
      },
    },
    {
      filetype: "diff",
      aliases: ["udiff", "patch"],
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-diff/releases/download/v0.1.0/tree-sitter-diff.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-diff/2520c3f934b3179bb540d23e0ef45f75304b5fed/queries/highlights.scm"],
      },
    },
    {
      filetype: "elixir",
      wasm: "https://github.com/elixir-lang/tree-sitter-elixir/releases/download/v0.3.5/tree-sitter-elixir.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/elixir/highlights.scm"],
      },
    },
    {
      filetype: "fsharp",
      wasm: "https://github.com/ionide/tree-sitter-fsharp/releases/download/0.3.0/tree-sitter-fsharp.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/fsharp/highlights.scm"],
      },
    },
    {
      filetype: "r",
      wasm: "https://github.com/r-lib/tree-sitter-r/releases/download/v1.2.0/tree-sitter-r.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/r/highlights.scm"],
      },
    },
    {
      filetype: "make",
      aliases: ["makefile"],
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-make/releases/download/v1.1.1/tree-sitter-make.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/make/highlights.scm"],
      },
    },
    {
      filetype: "vim",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-vim/releases/download/v0.8.1/tree-sitter-vim.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/vim/highlights.scm"],
      },
    },
    {
      filetype: "xml",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/xml/highlights.scm"],
      },
    },
    {
      filetype: "agda",
      wasm: "https://github.com/tree-sitter/tree-sitter-agda/releases/download/v1.3.3/tree-sitter-agda.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/agda/highlights.scm"],
      },
    },
    {
      // The upstream grammar repo publishes no wasm release assets; use the
      // npm-built wasm from the `tree-sitter-wasms` prebuild package. The
      // query must match the grammar revision that package builds: pin the
      // dart repo's query to the newest commit that compiles against it
      // (the npm-published query is older than the wasm's grammar).
      filetype: "dart",
      wasm: "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-dart.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/UserNobody14/tree-sitter-dart/507c5546dc73667c03d36803ee9bd4df0bbe4b0b/queries/highlights.scm"],
      },
    },
    {
      filetype: "solidity",
      aliases: ["sol"],
      // Query pinned to the exact grammar revision `tree-sitter-wasms`
      // builds the wasm from (see its package.json); the npm-published
      // query targets a newer grammar and does not compile against it.
      wasm: "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-solidity.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/JoranHonig/tree-sitter-solidity/b239a95f94cfcc6e7b3e961bc73a28d55e214f02/queries/highlights.scm"],
      },
    },
    {
      filetype: "powershell",
      aliases: ["ps1", "psm1"],
      wasm: "https://unpkg.com/tree-sitter-powershell@0.26.4/tree-sitter-powershell.wasm",
      queries: {
        highlights: ["https://unpkg.com/tree-sitter-powershell@0.26.4/queries/highlights.scm"],
      },
    },
    {
      filetype: "svelte",
      wasm: "https://unpkg.com/tree-sitter-svelte@0.11.0/tree-sitter-svelte.wasm",
      queries: {
        highlights: ["https://unpkg.com/tree-sitter-svelte@0.11.0/queries/highlights.scm"],
      },
    },
    {
      filetype: "objc",
      aliases: ["objectivec"],
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-objc/releases/download/v3.0.2/tree-sitter-objc.wasm",
      queries: {
        highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/objc/highlights.scm"],
      },
    },
  ],
} satisfies { parsers: { filetype: string; aliases?: string[]; wasm: string; queries: { highlights: string[]; injections?: string[] } }[] };
