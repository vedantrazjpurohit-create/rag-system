# RAG Evaluation Notes

## Baseline (1024-token chunks)

The initial baseline used 1024-token chunks with 128 overlap. Retrieval felt slow and often returned whole sections instead of the exact paragraph.

## Smaller chunks experiment (256 tokens)

When chunk size was reduced to 256 tokens, recall@5 improved on the test question set. However, the generator started stitching unrelated facts unless a strict citation check was enforced at answer time.

## Takeaway

Chunking is not a hyperparameter you set once. Measure recall and faithfulness together — optimizing one in isolation misleads you.