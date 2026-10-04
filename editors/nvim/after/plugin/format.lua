-- conform.nvim: unifica formatters por tipo de archivo.
-- Lo dejamos “manual” (por keymap) para mantener control y evitar sorpresas.
require("conform").setup({
  formatters_by_ft = {
    terraform = { "terraform_fmt" },
    tf = { "terraform_fmt" },
    sh = { "shfmt" },
    -- yaml: puedes dejarlo a LSP fallback o meter formatter si te interesa.
  },
})

vim.keymap.set("n", "<leader>f", function()
  require("conform").format({ lsp_fallback = true })
end, { desc = "Format (conform/LSP)" })
