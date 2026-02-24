#!/usr/bin/env python3
"""
ECU Simulator - Sensor Correlation ML Model Training Script
Author: Marcelo Duchene
Description: Trains regression models to capture interdependencies between automotive sensors
"""

import pandas as pd
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import PolynomialFeatures
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
import json

def train_sensor_models(csv_path: str, output_json: str):
    """Train sensor correlation models from OBD-II data."""
    df = pd.read_csv(csv_path)
    
    sensor_cols = ['rpm', 'speed', 'coolant_temp', 'intake_air_temp', 'throttle',
                   'engine_load', 'maf', 'map_kpa', 'ambient_temp', 'fuel_level', 'voltage']
    
    # Correlation matrix
    corr = df[sensor_cols].corr()
    
    # Per-scenario statistics
    scenario_stats = {}
    for scenario in df['scenario'].unique():
        sdf = df[df['scenario'] == scenario]
        stats = {}
        for col in sensor_cols:
            stats[col] = {
                'mean': float(sdf[col].mean()),
                'std': float(sdf[col].std()),
                'min': float(sdf[col].min()),
                'max': float(sdf[col].max()),
            }
        scenario_stats[scenario] = stats
    
    # Regression models
    models = {}
    
    # RPM + Throttle -> MAF
    poly = PolynomialFeatures(degree=2, include_bias=False)
    X = poly.fit_transform(df[['rpm', 'throttle']].values)
    y = df['maf'].values
    reg = Ridge(alpha=0.1).fit(X, y)
    models['rpm_throttle_to_maf'] = {
        'features': list(poly.get_feature_names_out(['rpm', 'throttle'])),
        'coefficients': [float(c) for c in reg.coef_],
        'intercept': float(reg.intercept_),
        'r2': float(r2_score(y, reg.predict(X)))
    }
    
    # Save
    output = {
        'correlation_matrix': {c: {c2: float(corr.loc[c, c2]) for c2 in sensor_cols} for c in sensor_cols},
        'regression_models': models,
        'scenario_statistics': scenario_stats,
    }
    
    with open(output_json, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Model saved to {output_json}")

if __name__ == '__main__':
    train_sensor_models(
        '/workspace/data/datasets/synthetic_obd2_driving_data.csv',
        '/workspace/data/sensor_correlation_model.json'
    )
