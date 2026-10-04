-- Esto instala lazy.nvim automáticamente si no existe.
-- lazy.nvim = gestor de plugins rápido y moderno.
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", lazypath
  })
end

vim.opt.rtp:prepend(lazypath)

-- Aquí declaras qué plugins quieres y cuándo se cargan.
require("lazy").setup({
  { import = "plugins" },
})
