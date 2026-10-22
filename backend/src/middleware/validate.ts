import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidationSchemas {
    body?: ZodSchema<any>;
    params?: ZodSchema<any>;
    query?: ZodSchema<any>;
}

export function validate(schemas: ValidationSchemas) {
    return (req: Request, res: Response, next: NextFunction) => {
        const errors: Record<string, string[]> = {};

        if (schemas.body) {
            const result = schemas.body.safeParse(req.body);
            if (!result.success) {
                errors.body = flattenZodErrors(result.error);
            } else {
                req.body = result.data;
            }
        }

        if (schemas.params) {
            const result = schemas.params.safeParse(req.params);
            if (!result.success) {
                errors.params = flattenZodErrors(result.error);
            } else {
                req.params = result.data;
            }
        }

        if (schemas.query) {
            const result = schemas.query.safeParse(req.query);
            if (!result.success) {
                errors.query = flattenZodErrors(result.error);
            } else {
                req.query = result.data;
            }
        }

        if (Object.keys(errors).length > 0) {
            res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors,
            });
            return;
        }

        next();
    };
}

function flattenZodErrors(error: ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
        return `${path}: ${issue.message}`;
    });
}