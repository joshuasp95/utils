return {
  -- =========================
  -- ESTÉTICA (cargada)
  -- =========================

  -- Tema con muy buen contraste y variantes
  { "folke/tokyonight.nvim", lazy = false, priority = 1000 },

  -- Iconos para archivos y UI
  { "nvim-tree/nvim-web-devicons", lazy = true },

  -- Statusline bonita (información abajo)
  { "nvim-lualine/lualine.nvim", dependencies = { "nvim-web-devicons" } },

  -- Tabs visuales (buffers como pestañas arriba)
  { "akinsho/bufferline.nvim", version = "*", dependencies = { "nvim-web-devicons" } },

  -- Guías de indentación (muy útil en YAML/TF)
  { "lukas-reineke/indent-blankline.nvim", main = "ibl" },

  -- Dashboard de inicio (estético)
  { "goolord/alpha-nvim", dependencies = { "nvim-web-devicons" } },

  -- Notificaciones bonitas (UI)
  { "rcarriga/nvim-notify" },

  -- Mejora visual de cmdline/messages (muy estético)
  { "folke/noice.nvim", event = "VeryLazy", dependencies = {
      "MunifTanjim/nui.nvim",
      "rcarriga/nvim-notify",
    }
  },

  -- Descubrir keymaps (pulsas leader y te enseña opciones)
  -- No añade “funcionalidad” nueva, solo UX.
  { "folke/which-key.nvim", event = "VeryLazy" },

  -- =========================
  -- FUNCIONAL (mínimo pro)
  -- =========================

  -- Telescope: buscar archivos (fd) y texto (rg) en repos grandes
  { "nvim-telescope/telescope.nvim", dependencies = { "nvim-lua/plenary.nvim" } },

  -- Treesitter: highlight serio y estructura (YAML/TF/JSON/…)
  { "nvim-treesitter/nvim-treesitter", build = ":TSUpdate" },

  -- LSP: diagnóstico, hover, go-to-definition…
  { "williamboman/mason.nvim" },             -- instala LSP servers fácilmente
  { "williamboman/mason-lspconfig.nvim" },   -- puente mason ↔ lspconfig
  { "neovim/nvim-lspconfig" },               -- configura servidores LSP

  -- Completion mínimo (sin snippets ni cosas raras)
  { "hrsh7th/nvim-cmp" },
  { "hrsh7th/cmp-nvim-lsp" },

  -- Formateo bajo demanda (no “IDE pesado”)
  { "stevearc/conform.nvim" },

  -- GROOVY
  --
  { "vim-scripts/groovy.vim", ft = { "groovy"}}

}
