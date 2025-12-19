#!/usr/bin/env python3
"""
Generate 48 trials of 30 test cases each from corpus-2.
Each test case is a single (problem_file, test_index) pair.
No test case appears in multiple trials.
No two test cases from the same problem file appear in the same trial.
If a problem has 10 tests, skip test 0 (use tests 1-9).
"""

import json
import os
import random
from pathlib import Path

# Set seed for reproducibility
random.seed(12345)

def deterministic_shuffle(items, seed):
    """Deterministic shuffle using a simple LCG."""
    items = items.copy()
    state = seed
    for i in range(len(items) - 1, 0, -1):
        state = (state * 9301 + 49297) % 233280
        j = int((state / 233280) * (i + 1))
        items[i], items[j] = items[j], items[i]
    return items

def get_corpus2_task_list():
    """Get list of all corpus-2 task files."""
    corpus_dir = Path(__file__).parent.parent.parent / 'corpus-2'
    task_list = []
    
    categories = [
        {'name': 'AboveBelow_v2', 'base': 'AboveBelow', 'count': 10},
        {'name': 'Center_v2', 'base': 'Center', 'count': 10},
        {'name': 'Cleanup_v2', 'base': 'CleanUp', 'count': 10},
        {'name': 'CompleteShape_v2', 'base': 'CompleteShape', 'count': 10, 'special': {1: 'completeShape1.json'}},
        {'name': 'Copy_v2', 'base': 'Copy', 'count': 10},
        {'name': 'Count_v2', 'base': 'Count', 'count': 10},
        {'name': 'ExtendToBoundary_v2', 'base': 'ExtendToBoundary', 'count': 10},
        {'name': 'ExtractObjects_v2', 'base': 'ExtractObjects', 'count': 10},
        {'name': 'FilledNotFilled_v2', 'base': 'FilledNotFilled', 'count': 10},
        {'name': 'HorizontalVertical_v2', 'base': 'HorizontalVertical', 'count': 10},
        {'name': 'InsideOutside_v2', 'base': 'InsideOutside', 'count': 10},
        {'name': 'MoveToBoundary_v2', 'base': 'MoveToBoundary', 'count': 10},
        {'name': 'Order_v2', 'base': 'Order', 'count': 10},
        {'name': 'SameDifferent_v2', 'base': 'SameDifferent', 'count': 10},
        {'name': 'TopBottom2D_v2', 'base': 'TopBottom2D', 'count': 10},
        {'name': 'TopBottom3D_v2', 'base': 'TopBottom3D', 'count': 10}
    ]
    
    for category in categories:
        for i in range(1, category['count'] + 1):
            if 'special' in category and i in category['special']:
                task_name = category['special'][i]
            else:
                task_name = f"{category['base']}{i}.json"
            
            task_path = corpus_dir / category['name'] / task_name
            if task_path.exists():
                # Use forward slashes for web compatibility
                relative_path = task_path.relative_to(corpus_dir.parent)
                task_list.append({
                    'problemIndex': len(task_list),
                    'taskPath': str(relative_path).replace('\\', '/'),
                    'taskName': f"{category['name']}/{task_name}",
                    'category': category['name']
                })
    
    return task_list

def generate_trials():
    """Generate 48 trials of 30 test cases each."""
    task_list = get_corpus2_task_list()
    corpus_dir = Path(__file__).parent.parent.parent / 'corpus-2'
    
    # Load all problem files and collect test cases
    test_cases = []
    
    print(f"Loading {len(task_list)} problem files...")
    for task in task_list:
        task_path = corpus_dir.parent / task['taskPath']
        try:
            with open(task_path, 'r') as f:
                data = json.load(f)
            
            train = data.get('train', [])
            test = data.get('test', [])
            
            # Determine usable test indices
            # If task has 10 tests, skip test 0 (use tests 1-9)
            if len(test) == 10:
                usable_test_indices = list(range(1, len(test)))
            else:
                usable_test_indices = list(range(len(test)))
            
            # Add all usable test cases
            for test_idx in usable_test_indices:
                test_cases.append({
                    'problemIndex': task['problemIndex'],
                    'testIndex': test_idx,
                    'taskPath': task['taskPath'],
                    'taskName': task['taskName'],
                    'train': train,
                    'testCase': test[test_idx]
                })
        except Exception as e:
            print(f"Error loading {task_path}: {e}")
            continue
    
    print(f"Total test cases available: {len(test_cases)}")
    print(f"Total test case slots needed: {48 * 30} (1440)")
    
    # Shuffle test cases deterministically
    shuffled_test_cases = deterministic_shuffle(test_cases, 12345)
    
    # Track usage count for each test case
    test_case_usage_count = {}
    for tc in shuffled_test_cases:
        key = f"{tc['problemIndex']}_{tc['testIndex']}"
        test_case_usage_count[key] = 0
    
    # Generate 48 trials
    trials = []
    test_case_index = 0
    
    for trial_num in range(1, 49):
        trial = {
            'trialNumber': trial_num,
            'testCases': []
        }
        
        used_problems_in_trial = set()
        test_cases_in_trial = []
        
        # Pass 1: Use only test cases that haven't been used yet
        for tc in shuffled_test_cases:
            if len(test_cases_in_trial) >= 30:
                break
            
            tc_key = f"{tc['problemIndex']}_{tc['testIndex']}"
            
            # Skip if this problem is already used in this trial
            if tc['problemIndex'] in used_problems_in_trial:
                continue
            
            # Only use test cases that haven't been used yet
            if test_case_usage_count[tc_key] == 0:
                test_cases_in_trial.append(tc)
                test_case_usage_count[tc_key] += 1
                used_problems_in_trial.add(tc['problemIndex'])
        
        # Pass 2: If we still need more, allow reuse (but still no same problem in same trial)
        if len(test_cases_in_trial) < 30:
            for tc in shuffled_test_cases:
                if len(test_cases_in_trial) >= 30:
                    break
                
                # Only constraint: no same problem twice in same trial
                if tc['problemIndex'] not in used_problems_in_trial:
                    test_cases_in_trial.append(tc)
                    tc_key = f"{tc['problemIndex']}_{tc['testIndex']}"
                    test_case_usage_count[tc_key] += 1
                    used_problems_in_trial.add(tc['problemIndex'])
        
        trial['testCases'] = test_cases_in_trial
        trials.append(trial)
        print(f"Trial {trial_num}: {len(test_cases_in_trial)} test cases")
    
    # Verify coverage
    uncovered_test_cases = [key for key, count in test_case_usage_count.items() if count == 0]
    if uncovered_test_cases:
        print(f"\nWarning: {len(uncovered_test_cases)} test cases were not used in any trial")
    else:
        print(f"\n✓ All test cases are covered in the trials!")
    
    return trials

def main():
    """Generate trials and save to JSON file and embedded JS file."""
    print("Generating trials...")
    trials = generate_trials()
    
    # Save to JSON file
    output_file = Path(__file__).parent / 'trials.json'
    with open(output_file, 'w') as f:
        json.dump(trials, f, indent=2)
    
    # Also save as embedded JavaScript for file:// protocol support
    js_output_file = Path(__file__).parent / 'js' / 'trials_data.js'
    with open(js_output_file, 'w') as f:
        f.write('// Auto-generated trials data\n')
        f.write('var TRIALS_DATA = ')
        json.dump(trials, f, indent=2)
        f.write(';\n')
    
    print(f"\nTrials saved to {output_file}")
    print(f"Trials also saved as JavaScript to {js_output_file}")
    print(f"Total trials: {len(trials)}")
    print(f"Total test cases: {sum(len(t['testCases']) for t in trials)}")

if __name__ == '__main__':
    main()

