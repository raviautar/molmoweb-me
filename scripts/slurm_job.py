# Pseudo/dummy script to run something for 1 day on slurm
import time
import torch
import traceback

try:
    x = torch.normal(0,1, size=(1,1)).int().cuda()
    time.sleep(86400)
except Exception as e:
    print("Error in slurm script:")
    print(e)
    traceback.print_exc()

"""
To find out CUDA_VISIBLE_DEIVCES on ar-asus2gpu, 
1. Launch a job
2. Run `nvidia-smi -L` to get all GPU IDs
3. Check on nvitop which GPU is being used by your job.
4. Depending on that pick the right GPU ID from `nvidia-smi -L`
5. To confirm run 
CUDA_VISIBLE_DEVICES=MIG-8ffda4ed-61f1-525c-9c9f-4f28e298efe0 python -c "import torch;
print('Visible devices:', torch.cuda.device_count());
print('Device name:', torch.cuda.get_device_name(0));
for i in range(3):
    x = torch.randn(10000, 10000, device='cuda');
    s = x.sum();
    torch.cuda.synchronize();
    print(f'Iter {i+1}: sum = {s.item()}')"
"""