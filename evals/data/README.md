# Benchmark data

`npm run eval:fallacy` downloads these files here on first run. They are not committed.

| File | Source | License |
|---|---|---|
| `logic.csv` | LOGIC test split (`data/edu_test.csv`) from [causalNLP/logical-fallacy](https://github.com/causalNLP/logical-fallacy). Jin et al. 2022, *Logical Fallacy Detection*, Findings of EMNLP. | No license is published in the repository, so the data is not redistributed here. |
| `argq.csv` | Test split of [IBM Argument Quality Ranking 30k](https://huggingface.co/datasets/ibm-research/argument_quality_ranking_30k). Gretz et al. 2020, *A Large-scale Dataset for Argument Quality Ranking*. | CC BY 3.0 |

The benchmark uses 100 LOGIC items (seeded random sample) as fallacies and the 100 highest-rated ArgQ arguments (`WA` score) as clean controls. High-rated ArgQ arguments are not guaranteed to be fallacy-free, so the false-positive rate is an upper bound.
