#!/bin/sh
# Build the textbook PDF via pandoc.
# Requires: pandoc + a LaTeX engine (xelatex / tectonic / wkhtmltopdf fallback).
cd "$(dirname "$0")"

FILES="00-title.md 01-introduction.md 02-data-and-ir.md 03-generic-structures.md \
04-operators.md 05-ensemble-method.md 06-heading-lab.md 07-field-model.md \
08-cross-validation.md 09-phasor-circuit.md 10-mushroom-body.md 11-benchmark.md \
12-compiler.md 13-synthesis.md A-reproduction.md"

if command -v pandoc >/dev/null 2>&1; then
  for ENGINE in tectonic xelatex pdflatex; do
    if command -v "$ENGINE" >/dev/null 2>&1; then
      pandoc $FILES -o fly-brain-textbook.pdf --pdf-engine="$ENGINE" \
        -V geometry:margin=1in -V fontsize=11pt -V documentclass=report
      echo "-> docs/textbook/fly-brain-textbook.pdf (engine: $ENGINE)"
      exit 0
    fi
  done
  echo "pandoc found but no PDF engine (tectonic/xelatex/pdflatex); producing HTML."
  pandoc $FILES -o fly-brain-textbook.html --standalone --toc
else
  echo "pandoc not found; install pandoc to build the book."
fi
