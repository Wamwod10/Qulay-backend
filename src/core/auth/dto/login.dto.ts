import { IsBoolean, IsOptional, IsString } from "class-validator";

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
