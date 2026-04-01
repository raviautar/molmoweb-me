#!/bin/bash
#SBATCH --job-name=m0lmoweb
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=60000
#SBATCH --time=3-00:00:00
#SBATCH --nodelist=ar-asus2gpu
#SBATCH --gres=gpu:1
#SBATCH --output=/shared_upload/model_comparison_ct_tree_v2/DL_Exps/2026_02_19_AR5093_ct_tree_refinement/_logs/%j_CTRefine.log
#SBATCH --error=/shared_upload/model_comparison_ct_tree_v2/DL_Exps/2026_02_19_AR5093_ct_tree_refinement/_logs/%j_CTRefine.err

echo "----------------------------------- slurm setting --------------------------------------"
echo
echo "on Hostname = $(hostname)"
echo "on GPU      = $CUDA_VISIBLE_DEVICES"
echo "python      = $(which python)"
echo
echo "$(nvidia-smi)"
echo
echo "------------------- calling commands $(date) ----------------------"
echo "
"

echo '============================ SLURM JOB STARTED =========================='

python "/home/prerak@medis.local/code/_tmp/slurm-job.py"

echo '============================ SLURM JOB FINISHED =========================='

##### ar-asus2gpu (nvidia-smi -L - https://medisimaging.atlassian.net/wiki/spaces/XNAT/pages/1665794051/Nvidia+MIG+Multi+Instance+GPU+Setup)
# GPU 0: NVIDIA RTX PRO 6000 Blackwell Server Edition (UUID: GPU-1021fd88-2975-894c-8ad9-3a30dcb1b327)
#   MIG 2g.48gb     Device  0: (UUID: MIG-5a089e72-e692-519b-9720-38e83c97e8ba)
#   MIG 2g.48gb     Device  1: (UUID: MIG-2b0d1e55-cce4-50d5-9741-e84e7d1a5b53)
# GPU 1: NVIDIA RTX PRO 6000 Blackwell Server Edition (UUID: GPU-8ecbd4ca-87cf-3f2d-fba2-51146af965cf)
#   MIG 2g.48gb     Device  0: (UUID: MIG-c2a78720-5464-5384-ae17-5f58deb12318)
#   MIG 2g.48gb     Device  1: (UUID: MIG-8ffda4ed-61f1-525c-9c9f-4f28e298efe0)

# Other commands
# watch -n 0.1 'squeue'
# watch -n 0.1 'nvidia-smi'
# dcgmi fieldgroup --list
# dcgmi dmon -e 1000