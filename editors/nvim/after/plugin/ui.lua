-- 1) Tema: hace que Neovim tenga una estética consistente.
vim.cmd.colorscheme("tokyonight")

-- 2) Statusline (lualine): barra inferior con modo, rama, archivo, diag…
require("lualine").setup({
  options = {
    theme = "tokyonight",
    section_separators = "",
    component_separators = "",
  },
})

-- 3) Bufferline: pestañas arriba para buffers abiertos.
require("bufferline").setup({
  options = {
    diagnostics = "nvim_lsp", -- muestra errores LSP en la tab
    show_buffer_close_icons = false,
    show_close_icon = false,
  },
})

-- 4) Indent guides: líneas verticales para indentación.
-- MUY útil en YAML, Terraform, Helm values…
require("ibl").setup()

-- 5) Notify: notificaciones bonitas (en vez del “echo” feo)
vim.notify = require("notify")

-- 6) Noice: mejora la UI del cmdline y mensajes.
-- Esto es puramente UX: mensajes más limpios, cmdline más visual.
require("noice").setup({
  presets = {
    bottom_search = true,
    command_palette = true,
    long_message_to_split = true,
  },
})

-- 7) Which-key: al pulsar leader te sugiere atajos.
require("which-key").setup()

-- 8) Dashboard: pantalla inicial bonita.
local alpha = require("alpha")
local dashboard = require("alpha.themes.dashboard")
dashboard.section.header.val = {
  "   _   _           _           ",
  "  | \\ | | ___  ___| |_ ___ _ __",
  "  |  \\| |/ _ \\/ __| __/ _ \\ '__|",
  "  | |\\  |  __/\\__ \\ ||  __/ |   ",
  "  |_| \\_|\\___||___/\\__\\___|_|   ",
}
dashboard.section.buttons.val = {
  dashboard.button("e", "  New file", ":ene <BAR> startinsert <CR>"),
  dashboard.button("f", "󰈞  Find file", ":Telescope find_files<CR>"),
  dashboard.button("g", "󰈬  Live grep", ":Telescope live_grep<CR>"),
  dashboard.button("q", "󰩈  Quit", ":qa<CR>"),
}
alpha.setup(dashboard.config)
