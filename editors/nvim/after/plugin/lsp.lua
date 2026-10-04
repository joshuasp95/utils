-- Mason: instala servidores LSP sin pelearte con paths.
require("mason").setup()

-- Mason-LSPConfig: lista de servidores que quieres “asegurar”
require("mason-lspconfig").setup({
  ensure_installed = {
    "terraformls",
    "yamlls",
    "bashls",
    "dockerls",
    "jsonls",
    "groovyls",
  },
})

local lspconfig = require("lspconfig")
local capabilities = require("cmp_nvim_lsp").default_capabilities()

-- on_attach: atajos solo cuando un LSP está activo en el buffer
local on_attach = function(_, bufnr)
  local map = function(mode, lhs, rhs, desc)
    vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, desc = desc })
  end

  -- Navegación semántica (lo mínimo que sí aporta)
  map("n", "gd", vim.lsp.buf.definition, "Go to definition")
  map("n", "gr", vim.lsp.buf.references, "References")
  map("n", "K", vim.lsp.buf.hover, "Hover docs")

  -- Acciones útiles (DevOps: renombrar keys/vars, quick fixes)
  map("n", "<leader>rn", vim.lsp.buf.rename, "Rename symbol")
  map("n", "<leader>ca", vim.lsp.buf.code_action, "Code action")
  map("n", "<leader>dd", vim.diagnostic.open_float, "Diagnostics float")
end

-- Config de servidores: ligera, sin personalización excesiva.
for _, server in ipairs({ "terraformls", "yamlls", "bashls", "dockerls", "jsonls", "groovyls" }) do
  lspconfig[server].setup({
    on_attach = on_attach,
    capabilities = capabilities,
  })
end

-- Completion mínimo con nvim-cmp:
-- No snippets, no AI, solo completar lo que el LSP sugiere.
local cmp = require("cmp")
cmp.setup({
  mapping = cmp.mapping.preset.insert({
    ["<C-Space>"] = cmp.mapping.complete(),               -- abre menú
    ["<CR>"] = cmp.mapping.confirm({ select = true }),    -- confirma
  }),
  sources = {
    { name = "nvim_lsp" },
  },
})
