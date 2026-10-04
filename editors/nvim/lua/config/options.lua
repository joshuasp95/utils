-- Opciones “core” para trabajar cómodo sin convertirlo en un IDE pesado.

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.wrap = false

-- Tabulación: para infra (YAML/TF) suele ir bien 2 espacios.
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2

-- UI/Color
vim.opt.termguicolors = true
vim.opt.signcolumn = "yes"     -- espacio fijo para diagnostics (evita saltos)
vim.opt.cursorline = true      -- resalta línea actual

-- Búsqueda
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Splits “naturales”
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Clipboard del sistema (en macOS)
vim.opt.clipboard = "unnamedplus"

-- Sensación más “rápida”
vim.opt.updatetime = 200
vim.opt.timeoutlen = 400

-- mouse disable mouse capture
vim.opt.mouse = ""
