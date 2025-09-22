# Chio Pinocchio Project

A Solana program built with the Chio CLI tool.

## Project Structure

```
src/
├── entrypoint.rs          # Program entry point with nostd_panic_handler
├── lib.rs                 # Library crate (no_std optimization)
├── instructions/          # Program instruction handlers  
├── states/                # Account state definitions
│   └── utils.rs           # State management helpers (load_acc, load_mut_acc)
└── errors.rs              # Program error definitions

tests/
└── tests.rs               # Unit tests using mollusk-svm framework
```

## Commands

```bash
# Build the program
chio build

# Run tests
chio test

# Deploy the program
chio deploy

# Get help
chio help
```

---

**Author of Chio CLI**: [4rjunc](https://github.com/4rjunc) | [Twitter](https://x.com/4rjunc)