-- Leader en SPACE (muy común y cómodo)
vim.g.mapleader = " "

local map = vim.keymap.set

-- Guardar/salir
map("n", "<leader>w", "<cmd>w<cr>", { desc = "Save" })
map("n", "<leader>q", "<cmd>q<cr>", { desc = "Quit" })

-- Moverte entre ventanas (splits) rápido
map("n", "<C-h>", "<C-w>h", { desc = "Window left" })
map("n", "<C-j>", "<C-w>j", { desc = "Window down" })
map("n", "<C-k>", "<C-w>k", { desc = "Window up" })
map("n", "<C-l>", "<C-w>l", { desc = "Window right" })

-- custom para mostrar paths
map("n", "<leader>fp", function()
  vim.notify(vim.fn.expand("%:p"))
end, { desc = "Show file path" })

map("n", "<leader>fwd", function()
  vim.notify(vim.fn.getcwd())
end, { desc = "Show current working dir"})
