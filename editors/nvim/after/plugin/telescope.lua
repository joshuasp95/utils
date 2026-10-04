-- Telescope usa ripgrep (rg) y fd para buscar MUY rápido en repos.
require("telescope").setup()

local map = vim.keymap.set
map("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Find files (fd)" })
map("n", "<leader>fg", "<cmd>Telescope live_grep<cr>", { desc = "Grep repo (rg)" })
map("n", "<leader>fb", "<cmd>Telescope buffers<cr>", { desc = "Buffers" })
